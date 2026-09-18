/**
 * The didi module: three doors to one bridge. The providers are exercised
 * against hand-rolled bpmn-js services — what matters is *when* each door
 * opens: the panel group and the pad entry on every step, the create prompt
 * on a call activity alone.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@bpmn-io/properties-panel", () => ({ Group: () => null }));
// The entry's `useService` hook comes from the panel's dist bundle, which
// drags the whole bpmn-js label-editing graph in; the providers under test
// never render the entry, so the hook is irrelevant here.
vi.mock("bpmn-js-properties-panel", () => ({ useService: vi.fn() }));

import CalledProcessEntry from "./CalledProcessEntry";
import { PROCESS_REF_ATTR } from "./calledProcess";
import {
  CALLED_PROCESS_GROUP_ID,
  CALLED_PROCESS_PAD_ENTRY,
  createCalledProcessModule,
} from "./calledProcessModule";
import type { CalledProcessBridge } from "./calledProcessModule";

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
  props: { calledElement?: string; processRef?: string } = {},
  extra: { labelTarget?: unknown } = {},
) {
  const values: Record<string, unknown> = {
    calledElement: props.calledElement,
    [PROCESS_REF_ATTR]: props.processRef,
  };
  return {
    id: "el",
    ...extra,
    businessObject: {
      $type: type,
      $instanceOf: (t: string) => t === type || (t === "bpmn:FlowNode" && FLOW_NODES.has(type)),
      calledElement: props.calledElement,
      get: (n: string) => values[n],
    },
  };
}

function bridge(): CalledProcessBridge {
  return {
    open: vi.fn(),
    openProcess: vi.fn(),
    names: {},
    labels: {
      group: "Linked process",
      choose: "Choose…",
      open: "Open",
      clear: "Clear",
      noProcess: "None",
      references: (r) => r,
      linkProcess: "Link process",
    },
  };
}

type Ctor = new (...args: unknown[]) => unknown;

/** Instantiate the module's services the way didi would, with fakes. */
function boot(b: CalledProcessBridge) {
  const mod = createCalledProcessModule(b) as unknown as Record<string, [string, unknown]>;
  const registered: { priority: number; provider: any }[] = [];
  const padProviders: any[] = [];
  const handlers: Record<string, (e: unknown) => void> = {};
  const services: Record<string, unknown> = {
    propertiesPanel: {
      registerProvider: (priority: number, provider: unknown) =>
        registered.push({ priority, provider }),
    },
    contextPad: { registerProvider: (p: unknown) => padProviders.push(p) },
    eventBus: { on: (name: string, cb: (e: unknown) => void) => (handlers[name] = cb) },
    turboCalledProcess: b,
  };
  for (const name of mod.__init__ as unknown as string[]) {
    const [kind, Klass] = mod[name];
    expect(kind).toBe("type");
    const deps = ((Klass as { $inject: string[] }).$inject ?? []).map((d) => services[d]);
    new (Klass as Ctor)(...deps);
  }
  return { registered, padProviders, handlers };
}

describe("createCalledProcessModule", () => {
  it("exposes the bridge as the turboCalledProcess value service", () => {
    const b = bridge();
    const mod = createCalledProcessModule(b) as unknown as Record<string, unknown>;
    expect(mod.turboCalledProcess).toEqual(["value", b]);
  });

  it("appends the Linked process group after the stock groups, on every step", () => {
    const b = bridge();
    const { registered } = boot(b);
    expect(registered).toHaveLength(1);
    // Below the built-in provider's 1000, so the group renders last.
    expect(registered[0].priority).toBe(500);
    const provider = registered[0].provider;

    const stock = [{ id: "general" }];
    for (const type of ["bpmn:UserTask", "bpmn:StartEvent", "bpmn:ExclusiveGateway"]) {
      const groups = provider.getGroups(element(type))(stock);
      expect(groups.map((g: { id: string }) => g.id)).toEqual(["general", CALLED_PROCESS_GROUP_ID]);
    }

    const groups = provider.getGroups(element("bpmn:CallActivity"))(stock);
    const group = groups[1];
    expect(group.label).toBe("Linked process");
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0].component).toBe(CalledProcessEntry);
    // The bridge rides on the entry: `Group` spreads it into the component.
    expect(group.entries[0].bridge).toBe(b);
  });

  it("leaves the stock groups alone for a pool, an artefact and a label", () => {
    const b = bridge();
    const { registered } = boot(b);
    const provider = registered[0].provider;
    const stock = [{ id: "general" }];
    expect(provider.getGroups(element("bpmn:Participant"))(stock)).toBe(stock);
    expect(provider.getGroups(element("bpmn:DataObjectReference"))(stock)).toBe(stock);
    expect(provider.getGroups(element("bpmn:SequenceFlow"))(stock)).toBe(stock);
    const label = element("bpmn:StartEvent", {}, { labelTarget: { id: "event" } });
    expect(provider.getGroups(label)(stock)).toBe(stock);
  });

  it("adds a context-pad entry on every step that opens the picker", () => {
    const b = bridge();
    const { padProviders } = boot(b);
    expect(padProviders).toHaveLength(1);
    const provider = padProviders[0];

    expect(provider.getContextPadEntries(element("bpmn:Participant"))).toEqual({});
    expect(provider.getContextPadEntries(element("bpmn:DataStoreReference"))).toEqual({});

    const el = element("bpmn:UserTask");
    const entries = provider.getContextPadEntries(el);
    const entry = entries[CALLED_PROCESS_PAD_ENTRY];
    expect(entry.group).toBe("edit");
    expect(entry.title).toBe("Link process");
    expect(entry.html).toContain("<svg");
    entry.action.click();
    expect(b.open).toHaveBeenCalledWith(el);

    expect(
      provider.getContextPadEntries(element("bpmn:CallActivity", { calledElement: UUID })),
    ).toHaveProperty(CALLED_PROCESS_PAD_ENTRY);
  });

  it("asks which process a freshly placed call activity calls — unless it already knows", () => {
    const b = bridge();
    const { handlers } = boot(b);
    const onCreate = handlers["commandStack.shape.create.postExecuted"];
    expect(onCreate).toBeTypeOf("function");

    const fresh = element("bpmn:CallActivity");
    onCreate({ context: { shape: fresh } });
    expect(b.open).toHaveBeenCalledWith(fresh);

    (b.open as ReturnType<typeof vi.fn>).mockClear();
    // A paste (or a replace that kept either attribute) is left alone…
    onCreate({ context: { shape: element("bpmn:CallActivity", { calledElement: UUID }) } });
    onCreate({ context: { shape: element("bpmn:CallActivity", { processRef: UUID }) } });
    // …and dropping a plain step never prompts, however linkable it is.
    onCreate({ context: { shape: element("bpmn:Task") } });
    onCreate({ context: { shape: element("bpmn:StartEvent") } });
    onCreate({ context: {} });
    expect(b.open).not.toHaveBeenCalled();
  });
});
