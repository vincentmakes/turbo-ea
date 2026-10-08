/**
 * ProcessNavigator — the tree builder, overlay colours, the house cards (leaf +
 * container: badges, keyboard, flow button, admin drag-and-drop) and the
 * Overview / Steps / Flow drawer tabs plus the fullscreen flow preview.
 *
 * Renders `ProcessNavigatorBody` through its context seam, so every source
 * call can be held open (a deferred promise) to observe the loading states,
 * and the capability set can be switched between the in-app and portal shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("@/features/bpm/BpmnViewer", () => ({
  default: ({ bpmnXml, elements }: { bpmnXml: string; elements: unknown[] }) => (
    <div data-testid="bpmn-viewer" data-elements={String(elements.length)}>
      {bpmnXml}
    </div>
  ),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ProcessNavigatorBody } from "./ProcessNavigator";
import {
  FULL_CAPABILITIES,
  ProcessNavigatorProvider,
  type NavigatorCapabilities,
  type NavigatorStep,
  type ProcessFlowPayload,
  type ProcessNavigatorSource,
} from "@/features/bpm/ProcessNavigatorContext";
import { processTypeOptionsFrom } from "@/features/bpm/useProcessTypeOptions";
import { hookState } from "@/test/hooks";
import { makeField, makeOption, makeSection, makeSubtype } from "@/test/fixtures/metamodel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROCESS_TYPES = processTypeOptionsFrom(
  [
    makeSection({
      section: "Classification",
      fields: [
        makeField({
          key: "processType",
          type: "single_select",
          options: [
            makeOption({ key: "core", label: "Core", color: "#1976d2" }),
            makeOption({ key: "support", label: "Support", color: "#607d8b" }),
          ],
        }),
      ],
    }),
  ],
  (o) => o.label ?? o.key,
  false,
);

const CORE_RGB = "rgb(25, 118, 210)"; // #1976d2
const GREY_RGB = "rgb(189, 189, 189)"; // #bdbdbd — "not set"
const DEFINED_RGB = "rgb(251, 192, 45)"; // #fbc02d — maturity "defined"

type Item = Record<string, unknown>;

function proc(id: string, name: string, overrides: Item = {}): Item {
  return {
    id,
    name,
    subtype: undefined,
    parent_id: null,
    attributes: { processType: "core" },
    lifecycle: {},
    app_count: 0,
    total_cost: 0,
    apps: [],
    data_objects: [],
    org_ids: [],
    ctx_ids: [],
    has_diagram: false,
    element_count: 0,
    ...overrides,
  };
}

const HOUSE: Item[] = [
  proc("o2c", "Order to Cash", {
    subtype: "valueChain",
    attributes: { processType: "core", sortOrder: 1 },
    has_diagram: true,
    element_count: 3,
    apps: [{ id: "app-1", name: "SAP" }],
    data_objects: [{ id: "do-1", name: "Customer" }],
  }),
  // Inserted out of order: the tree sorts siblings by sortOrder.
  proc("quote", "Quote", { parent_id: "o2c", attributes: { processType: "core", sortOrder: 2 } }),
  proc("billing", "Billing", {
    parent_id: "o2c",
    attributes: { processType: "core", sortOrder: 1 },
    apps: [{ id: "app-2", name: "CRM" }],
    data_objects: [{ id: "do-2", name: "Invoice" }],
  }),
  proc("pricing", "Pricing", { parent_id: "quote" }),
  proc("p2p", "Procure to Pay", { attributes: { processType: "core", sortOrder: 2 } }),
  proc("hr", "Hire to Retire", { attributes: { processType: "support" } }),
];

const STEPS: NavigatorStep[] = [
  {
    id: "s1",
    bpmn_element_id: "task_1",
    element_type: "userTask",
    name: "Receive Order",
    lane_name: "Sales",
    is_automated: true,
    sequence_order: 0,
    data_object_id: "do-1",
    data_object_name: "Customer",
    it_component_id: "itc-1",
    it_component_name: "Oracle DB",
    business_process_id: "callee-1",
    business_process_name: "Credit Check",
  },
  {
    id: "s2",
    bpmn_element_id: "gw_1",
    element_type: "exclusiveGateway",
    name: "Check Stock",
    lane_name: "Sales",
    is_automated: false,
    sequence_order: 1,
  },
  {
    id: "s3",
    bpmn_element_id: "end_1",
    element_type: "endEvent",
    name: "Done",
    lane_name: "Sales",
    is_automated: false,
    sequence_order: 2,
  },
];

const FLOW: ProcessFlowPayload = {
  bpmnXml: "<xml/>",
  svgThumbnail: null,
  steps: STEPS,
  hasDrafts: false,
};

const CARD = {
  description: "Card description",
  lifecycle: {},
  approval_status: "APPROVED",
  tags: [],
};

const PORTAL_CAPS: NavigatorCapabilities = {
  viewModes: ["house"],
  drawerTabs: ["overview", "steps", "flow"],
  canOpenCard: false,
  canReorder: false,
  showRollups: false,
  persistPreferences: false,
};

interface RenderOpts {
  items?: Item[];
  route?: string;
  caps?: Partial<NavigatorCapabilities>;
  source?: Partial<ProcessNavigatorSource>;
  /** Drop `loadCard` / `reorderCards` / `saveRowOrder`, like a portal source. */
  portalSource?: boolean;
}

function renderBody(o: RenderOpts = {}) {
  const source: ProcessNavigatorSource = {
    loadMap: async () => ({ items: o.items ?? HOUSE, organizations: [], rowOrder: [] }),
    loadFlow: vi.fn(async () => FLOW),
    ...(o.portalSource
      ? {}
      : {
          loadCard: vi.fn(async () => CARD as Record<string, unknown>),
          reorderCards: vi.fn(async () => {}),
          saveRowOrder: vi.fn(async () => {}),
        }),
    ...o.source,
  };
  const capabilities: NavigatorCapabilities = { ...FULL_CAPABILITIES, ...o.caps };
  const meta = {
    typeIcon: "route",
    typeColor: "#028f00",
    subtypes: [
      makeSubtype({ key: "valueChain", label: "Value Chain" }),
      makeSubtype({ key: "enabling", label: "Enabling" }),
    ],
    processTypes: PROCESS_TYPES,
  };
  render(
    <MemoryRouter initialEntries={[o.route ?? "/bpm"]}>
      <ProcessNavigatorProvider value={{ source, capabilities, meta }}>
        <ProcessNavigatorBody />
      </ProcessNavigatorProvider>
    </MemoryRouter>,
  );
  return source;
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The card element (leaf or container) whose title is `name`. */
function cardOf(name: string): HTMLElement {
  const title = screen.getAllByText(name).find((el) => el.closest("[draggable]"));
  if (!title) throw new Error(`no card ${name}`);
  return title.closest("[draggable]") as HTMLElement;
}

/** A leaf card's coloured header (the strip carrying the name). */
function leafHeader(name: string): HTMLElement {
  return within(cardOf(name)).getByText(name).parentElement as HTMLElement;
}

/** A container card's clickable header. */
function containerHeader(name: string): HTMLElement {
  return within(cardOf(name)).getByText(name).closest("[tabindex='0']") as HTMLElement;
}

// `hidden`: a preview dialog opened on top marks the drawer aria-hidden.
const overviewTab = () => screen.queryByRole("tab", { name: /Overview/, hidden: true });

/** The drawer's paper, once open. */
async function drawer() {
  const tab = await screen.findByRole("tab", { name: /Overview/ });
  return within(tab.closest(".MuiDrawer-paper") as HTMLElement);
}

/**
 * Every node added to or removed from the document while `run` executes, with
 * its text as it was at that moment. A state committed and then replaced in
 * the same tick (a one-frame flash) still shows up here.
 */
async function seenDuring(run: () => Promise<void> | void) {
  const nodes: Node[] = [];
  const texts: string[] = [];
  const collect = (records: MutationRecord[]) => {
    for (const r of records) {
      for (const n of [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]) {
        nodes.push(n);
        texts.push(n.textContent ?? "");
      }
    }
  };
  const obs = new MutationObserver(collect);
  obs.observe(document.body, { childList: true, subtree: true });
  await run();
  collect(obs.takeRecords());
  obs.disconnect();
  return {
    showedText: (text: string) => texts.some((t) => t.includes(text)),
    showedProgress: () =>
      nodes.some(
        (n) =>
          n instanceof Element &&
          (n.matches("[role='progressbar']") || n.querySelector("[role='progressbar']") !== null),
      ),
  };
}

/** Errors thrown inside React event handlers surface as window `error` events. */
function collectWindowErrors() {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };
  window.addEventListener("error", onError);
  return { errors, stop: () => window.removeEventListener("error", onError) };
}

beforeEach(() => {
  hookState.reset();
  mockNavigate.mockReset();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

describe("tree builder", () => {
  it("orders roots by sortOrder, then name, and keeps an orphan as a root", async () => {
    renderBody({
      items: [
        proc("z", "Zulu"),
        proc("a", "Alpha"),
        proc("b", "Bravo", { attributes: { processType: "core", sortOrder: 2 } }),
        proc("y", "Yankee"),
        // Its parent is not in the payload (archived, or hidden from the reader).
        proc("g", "Ghost Child", { parent_id: "gone" }),
        proc("c", "Charlie", { attributes: { processType: "core", sortOrder: 1 } }),
      ],
    });
    await screen.findByText("Ghost Child");
    const order = screen
      .getAllByText(/^(Alpha|Bravo|Charlie|Ghost Child|Yankee|Zulu)$/)
      .map((el) => el.textContent);
    expect(order).toEqual(["Charlie", "Bravo", "Alpha", "Ghost Child", "Yankee", "Zulu"]);
  });

  it("orders children by sortOrder inside their container", async () => {
    renderBody();
    await screen.findByText("Quote");
    const kids = screen.getAllByText(/^(Billing|Quote)$/).map((el) => el.textContent);
    expect(kids).toEqual(["Billing", "Quote"]);
  });

  it("rolls the data objects of sub-processes up into the parent", async () => {
    const user = userEvent.setup();
    renderBody();
    await user.click(await screen.findByText("Order to Cash"));
    const d = await drawer();
    expect(d.getByRole("tab", { name: /Data \(2\)/ })).toBeInTheDocument();
    expect(d.getByText("Data Objects").previousElementSibling).toHaveTextContent("2");
  });

  it("names every ancestor of the zoomed process in the breadcrumbs", async () => {
    renderBody({ route: "/bpm?zoom=quote" });
    const nav = within(await screen.findByRole("navigation"));
    expect(nav.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "All Processes",
      "Order to Cash",
      "Quote",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Overlay colours
// ---------------------------------------------------------------------------

describe("card colours", () => {
  const COLOUR_ITEMS = [
    proc("cc", "Core Card", { attributes: { processType: "core", maturity: "defined" } }),
    proc("uc", "Unset Card", { attributes: {} }),
    proc("oc", "Odd Card", { attributes: { processType: "core", maturity: "bogus" } }),
  ];

  it("colours by process type, grey when the card has none", async () => {
    renderBody({ items: COLOUR_ITEMS });
    await screen.findByText("Core Card");
    expect(getComputedStyle(leafHeader("Core Card")).backgroundColor).toBe(CORE_RGB);
    expect(getComputedStyle(leafHeader("Unset Card")).backgroundColor).toBe(GREY_RGB);
  });

  it("colours by maturity, grey for a value the overlay does not know", async () => {
    const user = userEvent.setup();
    renderBody({ items: COLOUR_ITEMS });
    await screen.findByText("Core Card");
    await user.click(screen.getByRole("button", { name: /Maturity/ }));
    expect(getComputedStyle(leafHeader("Core Card")).backgroundColor).toBe(DEFINED_RGB);
    expect(getComputedStyle(leafHeader("Odd Card")).backgroundColor).toBe(GREY_RGB);
    expect(getComputedStyle(leafHeader("Unset Card")).backgroundColor).toBe(GREY_RGB);
  });

  it("survives a stale overlay in the URL", async () => {
    renderBody({
      route: "/bpm?overlay=legacyOverlay",
      items: [proc("x", "Legacy Card", { attributes: { processType: "core", legacyOverlay: "x" } })],
    });
    await screen.findByText("Legacy Card");
    expect(getComputedStyle(leafHeader("Legacy Card")).backgroundColor).toBe(GREY_RGB);
  });
});

// ---------------------------------------------------------------------------
// Leaf cards
// ---------------------------------------------------------------------------

describe("leaf cards", () => {
  it("badges a leaf with its rollups, steps, flow and sub-processes", async () => {
    renderBody({ route: "/bpm?level=1" });
    await screen.findByText("Order to Cash");
    const o2c = within(cardOf("Order to Cash"));
    expect(o2c.getByLabelText("2 applications")).toHaveTextContent("2");
    expect(o2c.getByLabelText("3 BPMN elements")).toHaveTextContent("3");
    expect(o2c.getByRole("button", { name: "View Flow" })).toBeInTheDocument();
    expect(
      o2c.getByRole("button", { name: "2 sub-processes — click to drill down" }),
    ).toHaveTextContent("+2");
    // The subtype is a caption in the footer.
    expect(o2c.getByText("Value Chain")).toHaveClass("MuiTypography-caption");
  });

  it("shows no badges a bare leaf does not earn", async () => {
    renderBody({ route: "/bpm?level=1" });
    await screen.findByText("Procure to Pay");
    const card = cardOf("Procure to Pay");
    const p2p = within(card);
    expect(p2p.queryByLabelText(/application/)).toBeNull();
    expect(p2p.queryByLabelText(/BPMN element/)).toBeNull();
    expect(p2p.queryByText("0")).toBeNull();
    expect(p2p.queryByText("+0")).toBeNull();
    expect(p2p.queryByRole("button", { name: "View Flow" })).toBeNull();
    // A leaf, not an empty container.
    expect(p2p.queryByRole("button", { name: "Drill down into this process" })).toBeNull();
    expect(card.querySelector(".MuiTypography-caption")).toBeNull();
  });

  it("labels a card with its own subtype", async () => {
    const user = userEvent.setup();
    renderBody({ items: [proc("en", "Enabler", { subtype: "enabling" })] });
    await screen.findByText("Enabler");
    expect(within(cardOf("Enabler")).getByText("Enabling")).toBeInTheDocument();
    expect(screen.queryByText("Value Chain")).toBeNull();
    await user.click(screen.getByText("Enabler"));
    const d = await drawer();
    expect(d.getByText("Enabling").closest(".MuiChip-root")).not.toBeNull();
    expect(d.queryByText("Value Chain")).toBeNull();
  });

  it("offers no flow when the map does not say there is one", async () => {
    const item = proc("nf", "No Flag");
    delete item.has_diagram;
    renderBody({ items: [item] });
    await screen.findByText("No Flag");
    expect(within(cardOf("No Flag")).queryByRole("button", { name: "View Flow" })).toBeNull();
  });

  it("hides the application rollup when the audience may not see it", async () => {
    renderBody({ route: "/bpm?level=1", caps: { showRollups: false } });
    await screen.findByText("Order to Cash");
    expect(within(cardOf("Order to Cash")).queryByLabelText(/application/)).toBeNull();
  });

  it("gives a nested leaf no drill chip of its own", async () => {
    renderBody();
    await screen.findByText("Quote");
    // Quote has a child but sits nested in Order to Cash at depth 2.
    expect(within(cardOf("Quote")).queryByText("+1")).toBeNull();
  });

  it("names the flow button in a tooltip", async () => {
    const user = userEvent.setup();
    renderBody({ route: "/bpm?level=1" });
    await screen.findByText("Order to Cash");
    await user.hover(within(cardOf("Order to Cash")).getByRole("button", { name: "View Flow" }));
    expect(await screen.findByRole("tooltip", {}, { timeout: 3000 })).toHaveTextContent("View Flow");
  });

  describe("keyboard", () => {
    it("opens on Enter without drilling, and ignores other keys", async () => {
      renderBody({ route: "/bpm?level=1" });
      await screen.findByText("Order to Cash");
      fireEvent.keyDown(cardOf("Order to Cash"), { key: "a" });
      expect(overviewTab()).toBeNull();
      expect(screen.queryByRole("button", { name: "All Processes" })).toBeNull();
      fireEvent.keyDown(cardOf("Order to Cash"), { key: "Enter" });
      expect(overviewTab()).not.toBeNull();
      expect(screen.queryByRole("button", { name: "All Processes" })).toBeNull();
    });

    it("does not drill into a leaf without sub-processes", async () => {
      renderBody({ route: "/bpm?level=1" });
      await screen.findByText("Procure to Pay");
      fireEvent.keyDown(cardOf("Procure to Pay"), { key: "ArrowRight" });
      expect(screen.queryByRole("button", { name: "All Processes" })).toBeNull();
      expect(overviewTab()).toBeNull();
      fireEvent.keyDown(cardOf("Procure to Pay"), { key: "Enter" });
      expect(overviewTab()).not.toBeNull();
      expect(screen.queryByRole("button", { name: "All Processes" })).toBeNull();
    });
  });

  describe("flow button", () => {
    const flowButton = () =>
      within(cardOf("Order to Cash")).getByRole("button", { name: "View Flow" });

    it("opens the preview on click without opening the drawer", async () => {
      const user = userEvent.setup();
      renderBody({ route: "/bpm?level=1" });
      await screen.findByText("Order to Cash");
      await user.click(flowButton());
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(overviewTab()).toBeNull();
    });

    it.each(["Enter", " "])("opens the preview on %j without opening the drawer", async (key) => {
      renderBody({ route: "/bpm?level=1" });
      await screen.findByText("Order to Cash");
      expect(fireEvent.keyDown(flowButton(), { key })).toBe(false);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(overviewTab()).toBeNull();
    });

    it("ignores other keys", async () => {
      renderBody({ route: "/bpm?level=1" });
      await screen.findByText("Order to Cash");
      fireEvent.keyDown(flowButton(), { key: "a" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Container cards
// ---------------------------------------------------------------------------

describe("container cards", () => {
  const CONTAINERS = [
    proc("plain", "Plain Parent", { subtype: "valueChain" }),
    proc("k1", "Kid One", { parent_id: "plain" }),
    proc("k2", "Kid Two", { parent_id: "plain" }),
    proc("steps", "Steps Parent", { element_count: 5 }),
    proc("k3", "Kid Three", { parent_id: "steps" }),
  ];

  it("labels its counts, and shows no flow icon without a flow or steps", async () => {
    renderBody({ items: CONTAINERS });
    await screen.findByText("Kid One");
    const plain = within(containerHeader("Plain Parent"));
    expect(plain.getByLabelText("2 sub-processes — click to drill down")).toHaveTextContent("2");
    expect(plain.queryByText("schema")).toBeNull();
    expect(plain.getByText("Value Chain")).toHaveClass("MuiTypography-caption");
  });

  it("explains the step count of a container without a flow", async () => {
    const user = userEvent.setup();
    renderBody({ items: CONTAINERS });
    await screen.findByText("Kid Three");
    const steps = within(containerHeader("Steps Parent"));
    expect(steps.getByText("5")).toBeInTheDocument();
    await user.hover(steps.getByText("schema"));
    expect(await screen.findByRole("tooltip", {}, { timeout: 3000 })).toHaveTextContent("5 BPMN elements");
  });

  it("names the flow button in a tooltip", async () => {
    const user = userEvent.setup();
    renderBody();
    await screen.findByText("Quote");
    const header = within(containerHeader("Order to Cash"));
    await user.hover(header.getByRole("button", { name: "View Flow" }));
    expect(await screen.findByRole("tooltip", {}, { timeout: 3000 })).toHaveTextContent("View Flow");
  });

  it("opens only on Enter", async () => {
    renderBody();
    await screen.findByText("Quote");
    fireEvent.keyDown(containerHeader("Order to Cash"), { key: "a" });
    expect(overviewTab()).toBeNull();
    fireEvent.keyDown(containerHeader("Order to Cash"), { key: "Enter" });
    expect(overviewTab()).not.toBeNull();
  });

  describe("flow button", () => {
    const flowButton = () =>
      within(containerHeader("Order to Cash")).getByRole("button", { name: "View Flow" });

    it("opens the preview on click without opening the drawer", async () => {
      const user = userEvent.setup();
      renderBody();
      await screen.findByText("Quote");
      await user.click(flowButton());
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(overviewTab()).toBeNull();
    });

    it.each(["Enter", " "])("opens the preview on %j without opening the drawer", async (key) => {
      renderBody();
      await screen.findByText("Quote");
      expect(fireEvent.keyDown(flowButton(), { key })).toBe(false);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(overviewTab()).toBeNull();
    });

    it("ignores other keys", async () => {
      renderBody();
      await screen.findByText("Quote");
      fireEvent.keyDown(flowButton(), { key: "a" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(overviewTab()).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

describe("drag and drop", () => {
  const handleOf = (card: HTMLElement) =>
    within(card).getAllByText("drag_indicator")[0].parentElement as HTMLElement;

  it("is not offered to a reader who may not reorder", async () => {
    renderBody({ route: "/bpm?level=1" });
    await screen.findByText("Order to Cash");
    expect(cardOf("Order to Cash")).toHaveAttribute("draggable", "false");
    expect(screen.queryByText("drag_indicator")).toBeNull();
  });

  it("is not offered on nested cards either", async () => {
    renderBody({ route: "/bpm?level=3" });
    await screen.findByText("Pricing");
    expect(cardOf("Quote")).toHaveAttribute("draggable", "false");
    expect(screen.queryByText("drag_indicator")).toBeNull();
  });

  describe("top-level leaves", () => {
    const opts = { route: "/bpm?level=1", caps: { canReorder: true } };

    it("reveals the handle while hovering the card", async () => {
      renderBody(opts);
      await screen.findByText("Order to Cash");
      const card = cardOf("Order to Cash");
      expect(card).toHaveAttribute("draggable", "true");
      expect(getComputedStyle(handleOf(card)).opacity).toBe("0");
      fireEvent.mouseEnter(card);
      expect(getComputedStyle(handleOf(card)).opacity).toBe("1");
      fireEvent.mouseLeave(card);
      expect(getComputedStyle(handleOf(card)).opacity).toBe("0");
    });

    it("refuses a drag not started from the handle", async () => {
      renderBody(opts);
      await screen.findByText("Order to Cash");
      const card = cardOf("Order to Cash");
      const dt: Record<string, unknown> = {};
      expect(fireEvent.dragStart(card, { dataTransfer: dt })).toBe(false);
      expect(dt.effectAllowed).toBeUndefined();
      expect(card.style.opacity).toBe("");

      // Releasing the handle before dragging disarms it again.
      fireEvent.mouseDown(handleOf(card));
      fireEvent.mouseUp(handleOf(card));
      expect(fireEvent.dragStart(card, { dataTransfer: {} })).toBe(false);
      expect(card.style.opacity).toBe("");
    });

    it("moves a card onto a sibling and saves the new order", async () => {
      const source = renderBody(opts);
      await screen.findByText("Order to Cash");
      const o2c = cardOf("Order to Cash");
      const p2p = cardOf("Procure to Pay");

      fireEvent.mouseDown(handleOf(o2c));
      const start: Record<string, unknown> = {};
      expect(fireEvent.dragStart(o2c, { dataTransfer: start })).toBe(true);
      expect(start.effectAllowed).toBe("move");
      expect(o2c.style.opacity).toBe("0.4");

      const over: Record<string, unknown> = {};
      expect(fireEvent.dragOver(p2p, { dataTransfer: over })).toBe(false);
      expect(over.dropEffect).toBe("move");
      expect(p2p.style.outline).toBe("2px solid #1976d2");
      fireEvent.dragLeave(p2p, { dataTransfer: {} });
      expect(p2p.style.outline).toBe("");

      fireEvent.dragOver(p2p, { dataTransfer: {} });
      expect(fireEvent.drop(p2p, { dataTransfer: {} })).toBe(false);
      expect(p2p.style.outline).toBe("");
      fireEvent.dragEnd(o2c, { dataTransfer: {} });
      expect(o2c.style.opacity).toBe("");

      await waitFor(() =>
        expect(source.reorderCards).toHaveBeenCalledWith([
          { id: "p2p", sortOrder: 0 },
          { id: "o2c", sortOrder: 1 },
        ]),
      );
      // The drag is over: the next one must be started from the handle again.
      expect(fireEvent.dragStart(o2c, { dataTransfer: {} })).toBe(false);
    });

    it("forgets an abandoned drag", async () => {
      const source = renderBody(opts);
      await screen.findByText("Order to Cash");
      const o2c = cardOf("Order to Cash");
      fireEvent.mouseDown(handleOf(o2c));
      fireEvent.dragStart(o2c, { dataTransfer: {} });
      fireEvent.dragEnd(o2c, { dataTransfer: {} });
      fireEvent.drop(cardOf("Procure to Pay"), { dataTransfer: {} });
      await act(async () => {});
      expect(source.reorderCards).not.toHaveBeenCalled();
    });

    it("ignores a drop when nothing is being dragged", async () => {
      const source = renderBody(opts);
      await screen.findByText("Order to Cash");
      const errs = collectWindowErrors();
      try {
        fireEvent.drop(cardOf("Procure to Pay"), { dataTransfer: {} });
        await act(async () => {});
      } finally {
        errs.stop();
      }
      expect(errs.errors).toEqual([]);
      expect(source.reorderCards).not.toHaveBeenCalled();
    });

    it("does not open the card when the handle is clicked", async () => {
      const user = userEvent.setup();
      renderBody(opts);
      await screen.findByText("Order to Cash");
      await user.click(handleOf(cardOf("Order to Cash")));
      expect(overviewTab()).toBeNull();
    });
  });

  describe("nested containers", () => {
    const opts = { route: "/bpm?level=3", caps: { canReorder: true } };

    it("are draggable while top-level containers use the row instead", async () => {
      renderBody(opts);
      await screen.findByText("Pricing");
      expect(cardOf("Quote")).toHaveAttribute("draggable", "true");
      expect(cardOf("Order to Cash")).toHaveAttribute("draggable", "false");
      expect(within(containerHeader("Order to Cash")).queryByText("drag_indicator")).toBeNull();
    });

    it("refuse a drag not started from the handle", async () => {
      renderBody(opts);
      await screen.findByText("Pricing");
      const quote = cardOf("Quote");
      const dt: Record<string, unknown> = {};
      expect(fireEvent.dragStart(quote, { dataTransfer: dt })).toBe(false);
      expect(dt.effectAllowed).toBeUndefined();
      expect(quote.style.opacity).toBe("");

      fireEvent.mouseDown(handleOf(quote));
      fireEvent.mouseUp(handleOf(quote));
      expect(fireEvent.dragStart(quote, { dataTransfer: {} })).toBe(false);
      expect(quote.style.opacity).toBe("");
    });

    it("drag from the handle, and reset when the drag ends", async () => {
      renderBody(opts);
      await screen.findByText("Pricing");
      const quote = cardOf("Quote");
      fireEvent.mouseDown(handleOf(quote));
      const dt: Record<string, unknown> = {};
      expect(fireEvent.dragStart(quote, { dataTransfer: dt })).toBe(true);
      expect(dt.effectAllowed).toBe("move");
      expect(quote.style.opacity).toBe("0.4");
      fireEvent.dragEnd(quote, { dataTransfer: {} });
      expect(quote.style.opacity).toBe("");
      expect(fireEvent.dragStart(quote, { dataTransfer: {} })).toBe(false);
    });

    it("forget an abandoned drag", async () => {
      const source = renderBody(opts);
      await screen.findByText("Pricing");
      const quote = cardOf("Quote");
      fireEvent.mouseDown(handleOf(quote));
      fireEvent.dragStart(quote, { dataTransfer: {} });
      fireEvent.dragEnd(quote, { dataTransfer: {} });
      fireEvent.drop(cardOf("Billing"), { dataTransfer: {} });
      await act(async () => {});
      expect(source.reorderCards).not.toHaveBeenCalled();
    });

    it("accept a sibling dropped onto them", async () => {
      const source = renderBody(opts);
      await screen.findByText("Pricing");
      const quote = cardOf("Quote");
      const billing = cardOf("Billing");
      fireEvent.mouseDown(handleOf(billing));
      fireEvent.dragStart(billing, { dataTransfer: {} });

      const over: Record<string, unknown> = {};
      expect(fireEvent.dragOver(quote, { dataTransfer: over })).toBe(false);
      expect(over.dropEffect).toBe("move");
      expect(quote.style.outline).toBe("2px solid #1976d2");
      fireEvent.dragLeave(quote, { dataTransfer: {} });
      expect(quote.style.outline).toBe("");
      fireEvent.dragOver(quote, { dataTransfer: {} });
      expect(fireEvent.drop(quote, { dataTransfer: {} })).toBe(false);
      expect(quote.style.outline).toBe("");

      await waitFor(() =>
        expect(source.reorderCards).toHaveBeenCalledWith([
          { id: "quote", sortOrder: 0 },
          { id: "billing", sortOrder: 1 },
        ]),
      );
    });

    it("ignore a drop when nothing is being dragged", async () => {
      const source = renderBody(opts);
      await screen.findByText("Pricing");
      const errs = collectWindowErrors();
      try {
        fireEvent.drop(cardOf("Quote"), { dataTransfer: {} });
        await act(async () => {});
      } finally {
        errs.stop();
      }
      expect(errs.errors).toEqual([]);
      expect(source.reorderCards).not.toHaveBeenCalled();
    });

    it("do not open the card when the handle is clicked", async () => {
      const user = userEvent.setup();
      renderBody(opts);
      await screen.findByText("Pricing");
      await user.click(handleOf(cardOf("Quote")));
      expect(overviewTab()).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Drawer: Overview
// ---------------------------------------------------------------------------

describe("drawer overview", () => {
  async function open(name: string, o: RenderOpts = {}) {
    const user = userEvent.setup();
    const source = renderBody(o);
    await user.click(await screen.findByText(name));
    return { user, source, d: await drawer() };
  }

  it("shows the rollups, the step count and the actions a container offers", async () => {
    const { d } = await open("Order to Cash");
    expect(d.getByText("Apps").previousElementSibling).toHaveTextContent("2");
    expect(d.getByText("Data Objects").previousElementSibling).toHaveTextContent("2");
    expect(d.getByText("Elements").previousElementSibling).toHaveTextContent("3");
    expect(d.getByRole("button", { name: /Drill down into this process/ })).toBeInTheDocument();
    expect(d.getByRole("button", { name: /View Flow/ })).toBeInTheDocument();
    // Its sub-processes: Billing has an app and no children, Quote the reverse.
    expect(d.getByText("Sub-Processes (2)")).toBeInTheDocument();
    expect(d.getByText("1 app")).toBeInTheDocument();
    expect(d.getByText("+1")).toBeInTheDocument();
    expect(d.queryByText("+0")).toBeNull();
    expect(d.queryByText("0 apps")).toBeNull();
  });

  it("shows the subtype as a chip beside the attribute chips", async () => {
    const { d } = await open("Order to Cash");
    expect(d.getByText("Type: Core")).toBeInTheDocument();
    expect(d.getByText("Value Chain").closest(".MuiChip-root")).not.toBeNull();
  });

  it("shows a bare process without chips, actions, lifecycle or sub-processes", async () => {
    const { d } = await open("Bare", {
      items: [proc("bare", "Bare", { attributes: {} })],
      source: { loadCard: vi.fn(async () => ({ lifecycle: {}, tags: [] })) },
    });
    await waitFor(() => expect(d.queryByRole("progressbar")).toBeNull());
    const paper = d.getByText("Elements").closest(".MuiDrawer-paper") as HTMLElement;
    expect(paper.querySelector(".MuiChip-root")).toBeNull();
    expect(d.queryByText("Lifecycle")).toBeNull();
    expect(d.queryByText(/Sub-Processes/)).toBeNull();
    expect(d.queryByText("Tags")).toBeNull();
  });

  it("offers the flow but no drill-down on a process without sub-processes", async () => {
    const { d } = await open("Flow Only", {
      items: [proc("fo", "Flow Only", { has_diagram: true })],
    });
    expect(d.getByRole("button", { name: /View Flow/ })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: /Drill down/ })).toBeNull();
  });

  it("offers the drill-down on a process with sub-processes but no flow", async () => {
    const { d } = await open("Billing Parent", {
      items: [proc("bp", "Billing Parent"), proc("bk", "Billing Kid", { parent_id: "bp" })],
      route: "/bpm?level=1",
    });
    expect(d.getByRole("button", { name: /Drill down into this process/ })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: /View Flow/ })).toBeNull();
  });

  it("shows a progress bar while the card loads, then the card", async () => {
    const card = deferred<Record<string, unknown>>();
    const { d } = await open("Procure to Pay", { source: { loadCard: () => card.promise } });
    expect(d.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => card.resolve({ description: "Loaded", approval_status: "APPROVED" }));
    expect(await d.findByText("Loaded")).toBeInTheDocument();
    expect(d.queryByRole("progressbar")).toBeNull();
  });

  it("refetches when switching to a sub-process, dropping the previous card meanwhile", async () => {
    const pending = deferred<Record<string, unknown>>();
    const loadCard = vi.fn(async (id: string) =>
      id === "o2c" ? { description: "Parent description" } : pending.promise,
    );
    const { user, d } = await open("Order to Cash", { source: { loadCard } });
    expect(await d.findByText("Parent description")).toBeInTheDocument();
    await user.click(d.getByText("Billing"));
    expect(await d.findByText("Billing", { selector: "h6" })).toBeInTheDocument();
    expect(loadCard).toHaveBeenLastCalledWith("billing");
    expect(d.queryByText("Parent description")).toBeNull();
    await act(async () => pending.resolve({ description: "Billing description" }));
    expect(await d.findByText("Billing description")).toBeInTheDocument();
  });

  it("names completion and colours the approval status", async () => {
    const { d } = await open("Procure to Pay", {
      source: {
        loadCard: vi.fn(async () => ({
          data_quality: 40,
          approval_status: "APPROVED",
          lifecycle: { active: "2020-01-01" },
          tags: [{ id: "t1", name: "Strategic", color: "#123456" }],
        })),
      },
    });
    expect(await d.findByText("Completion")).toBeInTheDocument();
    const tag = d.getByText("Strategic").closest(".MuiChip-root") as HTMLElement;
    expect(getComputedStyle(tag).backgroundColor).toBe("rgb(18, 52, 86)");
    expect(d.getByText("40%")).toBeInTheDocument();
    expect(d.getByText("Lifecycle")).toBeInTheDocument();
    expect(d.getByText("APPROVED").closest(".MuiChip-root")).toHaveClass("MuiChip-colorSuccess");
  });

  it("colours a broken approval as a warning", async () => {
    const { d } = await open("Procure to Pay", {
      source: { loadCard: vi.fn(async () => ({ approval_status: "BROKEN" })) },
    });
    expect((await d.findByText("BROKEN")).closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorWarning",
    );
  });

  it("in a portal: no card fetch, no progress bar, no landscape rollups", async () => {
    const user = userEvent.setup();
    renderBody({ caps: PORTAL_CAPS, portalSource: true });
    const title = await screen.findByText("Procure to Pay");
    const seen = await seenDuring(() => user.click(title));
    const d = await drawer();
    expect(d.getByText("Elements")).toBeInTheDocument();
    expect(d.queryByText("Data Objects")).toBeNull();
    expect(d.queryByText("Apps")).toBeNull();
    expect(d.queryByRole("progressbar")).toBeNull();
    expect(seen.showedProgress()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drawer: Steps
// ---------------------------------------------------------------------------

describe("drawer steps", () => {
  async function openSteps(o: RenderOpts = {}, name = "Procure to Pay") {
    const user = userEvent.setup();
    renderBody(o);
    await user.click(await screen.findByText(name));
    const d = await drawer();
    const seen = await seenDuring(() => user.click(d.getByRole("tab", { name: /Steps/ })));
    return { user, d, seen };
  }

  it("shows a progress bar while the steps load, never the empty state", async () => {
    const flow = deferred<ProcessFlowPayload>();
    const { d, seen } = await openSteps({ source: { loadFlow: () => flow.promise } });
    expect(d.getByRole("progressbar")).toBeInTheDocument();
    expect(d.queryByText(/No BPMN elements found/)).toBeNull();
    await act(async () => flow.resolve(FLOW));
    expect(await d.findByText("Receive Order")).toBeInTheDocument();
    expect(d.queryByRole("progressbar")).toBeNull();
    expect(seen.showedText("No BPMN elements found")).toBe(false);
  });

  it("lists one lane without a header, with an arrow between consecutive steps", async () => {
    const { d } = await openSteps();
    expect(await d.findByText("Receive Order")).toBeInTheDocument();
    expect(d.getByText("Auto")).toBeInTheDocument();
    expect(d.queryByText("Sales")).toBeNull();
    expect(d.getAllByText("arrow_downward")).toHaveLength(2);
  });

  it("names the linked process, and adds no chip a step does not link", async () => {
    const { d } = await openSteps();
    await d.findByText("Receive Order");
    expect(d.getByRole("button", { name: "Linked process" })).toHaveTextContent("Credit Check");
    // The step's content column: its name row, type and (absent) link chips.
    const doneContent = d.getByText("Done").parentElement!.parentElement as HTMLElement;
    expect(doneContent.querySelector(".MuiChip-root")).toBeNull();
  });

  it("falls back to a generic message when the load fails without one", async () => {
    const { d } = await openSteps({ source: { loadFlow: () => Promise.reject(undefined) } });
    expect(await d.findByText("Failed to load elements")).toBeInTheDocument();
  });

  it("in a portal the data object and IT component chips go nowhere", async () => {
    const { user, d } = await openSteps({ caps: PORTAL_CAPS, portalSource: true });
    const customer = await d.findByText("Customer");
    expect(customer.closest("[role='button']")).toBeNull();
    expect(d.getByText("Oracle DB").closest("[role='button']")).toBeNull();
    await user.click(customer);
    await user.click(d.getByText("Oracle DB"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drawer: Flow
// ---------------------------------------------------------------------------

describe("drawer flow", () => {
  async function openFlowTab(flow: ProcessFlowPayload | Promise<ProcessFlowPayload>) {
    const user = userEvent.setup();
    renderBody({ source: { loadFlow: vi.fn(() => Promise.resolve(flow)) } });
    await user.click(await screen.findByText("Procure to Pay"));
    const d = await drawer();
    const seen = await seenDuring(() => user.click(d.getByRole("tab", { name: /Flow/ })));
    return { d, seen };
  }

  it("spins while loading, never flashing the empty state", async () => {
    const flow = deferred<ProcessFlowPayload>();
    const { d, seen } = await openFlowTab(flow.promise);
    expect(d.queryByText("No process flow available.")).toBeNull();
    expect(d.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => flow.resolve({ ...FLOW, bpmnXml: null }));
    expect(await d.findByText("No process flow available.")).toBeInTheDocument();
    expect(seen.showedText("No process flow available.")).toBe(false);
  });

  it("prefers the published flow over pending drafts", async () => {
    const { d } = await openFlowTab({ ...FLOW, hasDrafts: true });
    expect(await d.findByText("Published flow available.")).toBeInTheDocument();
    expect(d.queryByText(/Draft available/)).toBeNull();
  });

  it("points at the drafts when nothing is published", async () => {
    const { d } = await openFlowTab({ ...FLOW, bpmnXml: null, hasDrafts: true });
    expect(await d.findByText("No published flow yet. Draft available.")).toBeInTheDocument();
  });

  it("renders only SVG from the thumbnail", async () => {
    const { d } = await openFlowTab({
      ...FLOW,
      svgThumbnail: "<svg data-testid='thumb'></svg><img data-testid='sneaky' src='x.png'>",
    });
    expect(await d.findByTestId("thumb")).toBeInTheDocument();
    expect(d.queryByTestId("sneaky")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fullscreen flow preview
// ---------------------------------------------------------------------------

describe("flow preview", () => {
  it("hands the viewer the steps, without flashing the empty state", async () => {
    const user = userEvent.setup();
    renderBody({ route: "/bpm?level=1" });
    await screen.findByText("Order to Cash");
    const button = within(cardOf("Order to Cash")).getByRole("button", { name: "View Flow" });
    const seen = await seenDuring(() => user.click(button));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/Order to Cash — Flow/)).toBeInTheDocument();
    expect(await dialog.findByTestId("bpmn-viewer")).toHaveAttribute("data-elements", "3");
    expect(seen.showedText("No process flow available.")).toBe(false);
  });
});
