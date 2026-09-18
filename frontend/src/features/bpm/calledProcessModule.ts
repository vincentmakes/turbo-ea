/**
 * The bpmn-js side of the call activity → Business Process link: one didi
 * module contributing three things, all reached through a single `bridge`
 * object the React side owns.
 *
 * Nobody types a process id by hand. The link is made by *picking a card*,
 * and there are three doors to the same picker dialog:
 *
 * 1. **Placing a call activity asks which process it calls.** A listener on
 *    the command stack opens the dialog the moment a `bpmn:CallActivity` is
 *    created — from the palette, the Create / Append element menus or a
 *    replace — unless it already carries a link (a paste). Cancelling leaves
 *    the shape unlinked; the two doors below remain.
 * 2. **A "Called process" group in the properties panel**, shown for call
 *    activities only. The plain BPMN provider renders nothing for a call
 *    activity (only the Camunda / Zeebe providers own a called-element UI, and
 *    those are never loaded), so the group cannot collide. Registered at
 *    priority 500: the built-in provider sits at 1000 and providers run in
 *    priority order, so the group lands after the standard ones — the slot
 *    the engine providers use.
 * 3. **A context-pad entry** on call activities, the on-canvas affordance
 *    that works with the panel collapsed — the `bpmn-js-color-picker`
 *    `ColorContextPadProvider` shape, verbatim.
 *
 * The bridge is a plain object: `open(element)` opens the React dialog,
 * `openProcess(id)` navigates to the callee, `names` is the id → name map the
 * React side fills after import (`fetchCardsByIds`) and after a pick, and
 * `labels` carries the i18next strings so this group is localised even though
 * the rest of the panel is not (deferred, see BpmnModeler). Every provider
 * reads the bridge at render time, so a mutated map or label shows on the next
 * render — which `eventBus.fire("propertiesPanel.providersChanged")` forces.
 */
import { Group } from "@bpmn-io/properties-panel";
import { getBusinessObject, is } from "bpmn-js/lib/util/ModelUtil";
import type { ModuleDeclaration } from "didi";

import CalledProcessEntry from "./CalledProcessEntry";
import { CALLED_PROCESS_COLOR } from "./calledProcess";

export interface CalledProcessLabels {
  /** Group heading — "Called process". */
  group: string;
  /** "Choose process…" */
  choose: string;
  /** "Open" — drill down to the callee. */
  open: string;
  /** "Clear" */
  clear: string;
  /** "No process linked" */
  noProcess: string;
  /** "References {{ref}}" — a foreign reference left by another tool. */
  references: (ref: string) => string;
  /** Context-pad entry title — "Link process". */
  linkProcess: string;
}

export interface CalledProcessBridge {
  /** Open the picker dialog for `element` (a `bpmn:CallActivity` shape). */
  open: (element: unknown) => void;
  /** Navigate to the callee's Process Flow tab. */
  openProcess: (cardId: string) => void;
  /** Card id → card name, for every uuid the diagram's call activities reference. */
  names: Record<string, string>;
  labels: CalledProcessLabels;
}

/** Group id — namespaced so it can never collide with a bpmn.io group. */
export const CALLED_PROCESS_GROUP_ID = "turboea__calledProcess";
/** Context-pad entry key. */
export const CALLED_PROCESS_PAD_ENTRY = "turboea-link-process";

// After the built-in provider (DEFAULT_PRIORITY = 1000).
const PROVIDER_PRIORITY = 500;

// Material Symbols "route" — the BusinessProcess type icon — drawn in the
// process colour so the entry reads as "process" next to the pad's own glyphs.
const LINK_PROCESS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 -960 960 960" fill="${CALLED_PROCESS_COLOR}"><path d="M245-165.53Q200-211.06 200-275v-349q-35-13-57.5-41.26-22.5-28.27-22.5-64.41Q120-776 152.5-808t78-32q45.5 0 77.5 32.14t32 78.05q0 35.81-22.5 64.31T260-624v349q0 39.19 27.5 67.09Q315-180 355.5-180t68-27.91Q451-235.81 451-275v-410q0-64.69 45.5-109.85Q542-840 606-840t109 45.15q45 45.16 45 109.85v349q35 13 57.5 41.5t22.5 64.5q0 46-32.5 78T730-120q-46 0-78-32t-32-78q0-36 22.5-64.5T700-336v-349q0-39-27.5-67T606-780q-39 0-67 28t-28 67v410q0 64-45.5 109.5T355-120q-64.5 0-110-45.53Z"/></svg>`;

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

class CalledProcessPropertiesProvider {
  static $inject = ["propertiesPanel", "turboCalledProcess"];

  constructor(
    propertiesPanel: PropertiesPanelService,
    private readonly bridge: CalledProcessBridge,
  ) {
    propertiesPanel.registerProvider(PROVIDER_PRIORITY, this);
  }

  getGroups(element: unknown) {
    return (groups: PanelGroup[]): PanelGroup[] => {
      if (!is(element as never, "bpmn:CallActivity")) return groups;
      return [
        ...groups,
        {
          id: CALLED_PROCESS_GROUP_ID,
          label: this.bridge.labels.group,
          // `Group` spreads every field of an entry into its component, plus
          // `element` — which is how the bridge reaches the Preact entry.
          component: Group,
          entries: [
            {
              id: `${CALLED_PROCESS_GROUP_ID}-entry`,
              component: CalledProcessEntry,
              bridge: this.bridge,
            },
          ],
        },
      ];
    };
  }
}

class CalledProcessContextPadProvider {
  static $inject = ["contextPad", "turboCalledProcess"];

  constructor(
    contextPad: ContextPadService,
    private readonly bridge: CalledProcessBridge,
  ) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element: unknown) {
    if (!is(element as never, "bpmn:CallActivity")) return {};
    const bridge = this.bridge;
    return {
      [CALLED_PROCESS_PAD_ENTRY]: {
        group: "edit",
        className: CALLED_PROCESS_PAD_ENTRY,
        title: bridge.labels.linkProcess,
        html: `<div class="entry">${LINK_PROCESS_SVG}</div>`,
        action: {
          click: () => bridge.open(element),
        },
      },
    };
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

  constructor(eventBus: EventBusService, bridge: CalledProcessBridge) {
    eventBus.on("commandStack.shape.create.postExecuted", (event) => {
      const shape = event.context?.shape;
      if (!shape || !is(shape as never, "bpmn:CallActivity")) return;
      if (getBusinessObject(shape as never).get("calledElement")) return;
      bridge.open(shape);
    });
  }
}

/** Build the didi module around the bridge the React side owns. */
export function createCalledProcessModule(bridge: CalledProcessBridge): ModuleDeclaration {
  return {
    __init__: [
      "calledProcessPropertiesProvider",
      "calledProcessContextPadProvider",
      "calledProcessCreatePrompt",
    ],
    turboCalledProcess: ["value", bridge],
    calledProcessPropertiesProvider: ["type", CalledProcessPropertiesProvider],
    calledProcessContextPadProvider: ["type", CalledProcessContextPadProvider],
    calledProcessCreatePrompt: ["type", CalledProcessCreatePrompt],
  } as ModuleDeclaration;
}
