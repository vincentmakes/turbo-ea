/**
 * The bpmn-js side of a step's card links: one didi module contributing three
 * things, all reached through a single `bridge` object the React side owns.
 *
 * A step carries five links — Business Process, Application, Data Object, IT
 * Component and Organizations — the same five the steps table shows, and
 * nobody types an id for any of them. The link is made by *picking a card*:
 *
 * 1. **Placing a call activity asks which process it calls.** A listener on
 *    the command stack opens the picker the moment a `bpmn:CallActivity` is
 *    created — from the palette, the Create / Append element menus or a
 *    replace — unless it already carries a link (a paste). Cancelling leaves
 *    the shape unlinked; the two doors below remain. Deliberately call
 *    activities only, and deliberately the process kind only: that is the one
 *    BPMN shape whose meaning *is* another process, and a prompt on every
 *    task drop would be noise.
 * 2. **A "Linked cards" group in the properties panel**, one labelled row per
 *    kind the shape offers (`linkKindsFor`). The plain BPMN provider owns no
 *    such group (only the Camunda / Zeebe providers own a called-element UI,
 *    and those are never loaded), so it cannot collide. Registered at
 *    priority 500: the built-in provider sits at 1000 and providers run in
 *    priority order, so the group lands after the standard ones — the slot
 *    the engine providers use.
 * 3. **A context-pad entry opening a menu of those same kinds**, the on-canvas
 *    affordance that works with the panel collapsed. One entry rather than
 *    five keeps the pad readable; the menu is diagram-js's own popup menu, so
 *    it inherits the look of the replace menu beside it.
 *
 * Where each link is stored is `calledProcess.ts`'s business, and the two
 * halves differ: the **process** link lives in the diagram (`processRefOf` /
 * `processRefProperties`) *and* in the draft, because BPMN has a construct for
 * it that other tools read; the **four card links** live only in the draft's
 * element links, written through the API by the React side — the very rows the
 * pre-link table edits, which is what keeps the editor and the table showing
 * one set of links.
 *
 * The bridge is a plain object: `openPicker(element, kind)` opens the React
 * dialog, `clearLink(element, kind)` removes a link, `openCard(id, kind)`
 * navigates to it, `links` is the per-element map the rows render, `names` is
 * the id → name map for a live diagram reference the server has not seen yet,
 * `canLinkCards` says whether a draft exists to store the card links in, and
 * `labels` carries the i18next strings so this group is localised even though
 * the rest of the panel is not (deferred, see BpmnModeler). Every provider
 * reads the bridge at render time, so a mutated map or label shows on the next
 * render — which `eventBus.fire("propertiesPanel.providersChanged")` forces.
 */
import { Group } from "@bpmn-io/properties-panel";
import { is } from "bpmn-js/lib/util/ModelUtil";
import type { ModuleDeclaration } from "didi";

import CalledProcessEntry from "./CalledProcessEntry";
import CardLinkEntry from "./CardLinkEntry";
import { CALLED_PROCESS_COLOR, elementIdOf, linkKindsFor, processRefOf } from "./calledProcess";
import type { CardLinkKind, ElementLinks, LinkKind } from "./calledProcess";

/** The strings one link row needs. */
export interface LinkKindLabels {
  /** Row label and menu entry — the card type's display name. */
  label: string;
  /** "Choose Application…" */
  choose: string;
  /** "No Application linked" */
  none: string;
}

export interface LinkLabels {
  /** Group heading — "Linked cards". */
  group: string;
  /** "Open" — drill down to the linked card. */
  open: string;
  /** "Clear" */
  clear: string;
  /** "References {{ref}}" — a foreign reference left by another tool. */
  references: (ref: string) => string;
  /** Context-pad entry title and popup-menu heading — "Link cards". */
  linkCards: string;
  kinds: Record<LinkKind, LinkKindLabels>;
}

export interface LinkBridge {
  /** Open the React picker dialog for `element`'s link of that kind. */
  openPicker: (element: unknown, kind: LinkKind) => void;
  /** Remove that link (the React side writes through to the API). */
  clearLink: (element: unknown, kind: LinkKind) => void;
  /** Navigate to a linked card — the process kind lands on its flow tab. */
  openCard: (cardId: string, kind: LinkKind) => void;
  /** Card id → card name, for a live diagram reference not yet on the server. */
  names: Record<string, string>;
  /** `bpmn_element_id` → the links the server resolved for that step. */
  links: Record<string, ElementLinks>;
  /** Whether a draft exists to store the four card links in. */
  canLinkCards: boolean;
  labels: LinkLabels;
}

/** Group id — namespaced so it can never collide with a bpmn.io group. */
export const CALLED_PROCESS_GROUP_ID = "turboea__calledProcess";
/** Context-pad entry key. */
export const LINK_PAD_ENTRY = "turboea-link-cards";
/** Popup-menu provider id — what the pad entry opens. */
export const LINK_MENU_ID = "turboea-link";

// After the built-in provider (DEFAULT_PRIORITY = 1000).
const PROVIDER_PRIORITY = 500;

// Material Symbols "link" — drawn in the BusinessProcess colour so the entry
// reads as "link a card" next to the pad's own glyphs.
const LINK_CARDS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 -960 960 960" fill="${CALLED_PROCESS_COLOR}"><path d="M280-240q-100 0-170-70T40-480q0-100 70-170t170-70h120v80H280q-66 0-113 47t-47 113q0 66 47 113t113 47h120v80H280Zm120-200v-80h160v80H400Zm160 200v-80h120q66 0 113-47t47-113q0-66-47-113t-113-47H560v-80h120q100 0 170 70t70 170q0 100-70 170t-170 70H560Z"/></svg>`;

type PanelGroup = { id: string; label: string; component: unknown; entries: unknown[] };

interface PropertiesPanelService {
  registerProvider: (priority: number, provider: unknown) => void;
}
interface ContextPadService {
  registerProvider: (provider: unknown) => void;
}
interface EventBusService {
  on: (event: string, callback: (event: { context?: { shape?: unknown } }) => void) => void;
}
interface PopupMenuService {
  registerProvider: (id: string, provider: unknown) => void;
  open: (
    target: unknown,
    providerId: string,
    position: { x: number; y: number; cursor?: { x: number; y: number } },
    options?: { title?: string; width?: string },
  ) => void;
  close: () => void;
}
interface CanvasService {
  getContainer: () => { querySelector: (selector: string) => Element | null };
}

class CalledProcessPropertiesProvider {
  static $inject = ["propertiesPanel", "turboCalledProcess"];

  constructor(
    propertiesPanel: PropertiesPanelService,
    private readonly bridge: LinkBridge,
  ) {
    propertiesPanel.registerProvider(PROVIDER_PRIORITY, this);
  }

  getGroups(element: unknown) {
    return (groups: PanelGroup[]): PanelGroup[] => {
      const kinds = linkKindsFor(element as never, this.bridge.canLinkCards);
      if (!kinds.length) return groups;
      return [
        ...groups,
        {
          id: CALLED_PROCESS_GROUP_ID,
          label: this.bridge.labels.group,
          // `Group` spreads every field of an entry into its component, plus
          // `element` — which is how the bridge and the kind reach the Preact
          // entries.
          component: Group,
          entries: kinds.map((kind) =>
            kind === "process"
              ? {
                  id: `${CALLED_PROCESS_GROUP_ID}-process`,
                  component: CalledProcessEntry,
                  bridge: this.bridge,
                }
              : {
                  id: `${CALLED_PROCESS_GROUP_ID}-${kind}`,
                  component: CardLinkEntry,
                  bridge: this.bridge,
                  kind,
                },
          ),
        },
      ];
    };
  }
}

class CalledProcessContextPadProvider {
  static $inject = ["contextPad", "popupMenu", "canvas", "turboCalledProcess"];

  constructor(
    contextPad: ContextPadService,
    private readonly popupMenu: PopupMenuService,
    private readonly canvas: CanvasService,
    private readonly bridge: LinkBridge,
  ) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element: unknown) {
    if (!linkKindsFor(element as never, this.bridge.canLinkCards).length) return {};
    const { popupMenu, canvas, bridge } = this;
    return {
      [LINK_PAD_ENTRY]: {
        group: "edit",
        className: LINK_PAD_ENTRY,
        title: bridge.labels.linkCards,
        html: `<div class="entry">${LINK_CARDS_SVG}</div>`,
        action: {
          click: (event: { x: number; y: number }, el: unknown) => {
            // Anchor the menu under the open pad, the way
            // `bpmn-js-create-append-anything` does — `contextPad.getPad()` is
            // deprecated in diagram-js 15 and warns on every call. The cursor
            // is the fallback when the pad element cannot be found.
            const pad = canvas.getContainer().querySelector(".djs-context-pad");
            const rect = pad?.getBoundingClientRect();
            const position = rect
              ? { x: rect.left, y: rect.bottom + 5 }
              : { x: event.x, y: event.y };
            popupMenu.open(
              el ?? element,
              LINK_MENU_ID,
              { ...position, cursor: { x: event.x, y: event.y } },
              { title: bridge.labels.linkCards, width: "240px" },
            );
          },
        },
      },
    };
  }
}

/**
 * The menu the pad entry opens: one line per link kind the shape offers.
 *
 * Triggering an entry does **not** close the menu by itself — diagram-js only
 * calls the action, and the replace menu gets away with it because a command
 * closes the menu for it. Ours opens a React dialog, so it closes explicitly.
 */
class LinkPopupMenuProvider {
  static $inject = ["popupMenu", "turboCalledProcess"];

  constructor(
    private readonly popupMenu: PopupMenuService,
    private readonly bridge: LinkBridge,
  ) {
    popupMenu.registerProvider(LINK_MENU_ID, this);
  }

  getPopupMenuEntries(element: unknown) {
    const { popupMenu, bridge } = this;
    const entries: Record<string, unknown> = {};
    for (const kind of linkKindsFor(element as never, bridge.canLinkCards)) {
      entries[`link-${kind}`] = {
        label: bridge.labels.kinds[kind].label,
        className: `turboea-link-menu-${kind}`,
        action: () => {
          popupMenu.close();
          bridge.openPicker(element, kind);
        },
      };
    }
    return entries;
  }
}

/**
 * Door 1. `shape.create` is the command every creation path ends in — a
 * palette drop, the Create / Append menus, a replace (which creates the new
 * shape inside `shape.replace`) — and `postExecuted` fires on execute and
 * redo, never on undo. A shape that already carries a link (a paste, a
 * replace that kept the attribute) is left alone.
 */
class CalledProcessCreatePrompt {
  static $inject = ["eventBus", "turboCalledProcess"];

  constructor(eventBus: EventBusService, bridge: LinkBridge) {
    eventBus.on("commandStack.shape.create.postExecuted", (event) => {
      const shape = event.context?.shape;
      if (!shape || !is(shape as never, "bpmn:CallActivity")) return;
      if (processRefOf(shape as never)) return;
      // A link made in a table leaves nothing in the diagram, so the shape
      // alone cannot answer "is this already linked?" — ask the bridge too,
      // or re-placing such a shape would prompt over a link that exists.
      const known = bridge.links[elementIdOf(shape as never)];
      if (known?.business_process) return;
      bridge.openPicker(shape, "process");
    });
  }
}

/** Build the didi module around the bridge the React side owns. */
export function createCalledProcessModule(bridge: LinkBridge): ModuleDeclaration {
  return {
    __init__: [
      "calledProcessPropertiesProvider",
      "calledProcessContextPadProvider",
      "linkPopupMenuProvider",
      "calledProcessCreatePrompt",
    ],
    turboCalledProcess: ["value", bridge],
    calledProcessPropertiesProvider: ["type", CalledProcessPropertiesProvider],
    calledProcessContextPadProvider: ["type", CalledProcessContextPadProvider],
    linkPopupMenuProvider: ["type", LinkPopupMenuProvider],
    calledProcessCreatePrompt: ["type", CalledProcessCreatePrompt],
  } as ModuleDeclaration;
}

/** @deprecated the bridge now covers every link kind. */
export type CalledProcessBridge = LinkBridge;
/** @deprecated kept so a stale import fails loudly at the type level. */
export type { CardLinkKind };
